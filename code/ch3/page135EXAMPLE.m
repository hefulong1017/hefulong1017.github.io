x1 = 0; x2 = 1; t1 = 0; t2 = 1;
h = 1/10; dt = 1/100;
x = x1:h:x2; x = x';
t = t1:dt:t2; t = t';
u = zeros(11, 101);

    u(:,1)=exp(x);
    u(1,:)=exp(t);
    u(11,:)=exp(1+t);

r = dt /(h^2) ;
row1 = zeros(9, 1);
row1(1, 1) = 5/6+r; row1(2, 1) =1/12 -r/2;
A = toeplitz(row1);
row1 = zeros(9, 1);
row1(1, 1) = 5/6-r; row1(2, 1) = 1/12+r/2;
B = toeplitz(row1);

for k = 1:100
    H = zeros(9, 1);
    H(1, 1) = (1/12+r/2) * u(1, k) -(1/12-1/2)*u(1, k+1);
    H(9, 1) =(1/12+r/2) * u(11, k) -(1/12-1/2)*u(11, k+1);

    u(2:10, k+1) = A\(B*u(2:10, k) + H);
end

% 计算误差
F = zeros(11, 101);
for i = 1:11
    for j = 1:101
        F(i, j) = exp(x(i)+ t(j));
    end
end
error = abs(u - F);
MaxErr = max(max(Error));
disp(['最大误差: ', num2str(MaxErr)]);
