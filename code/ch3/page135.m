for ii=1:4
m=10*2^(ii-1);
n=100*4^(ii-1);
x1 = 0; x2 = 1; t1 = 0; t2 = 1;
h = (x2-x1)/m; dt =(t2-t1)/n;
x = x1:h:x2; x = x';
t = t1:dt:t2; t = t';
u = zeros(m+1, n+1);

    u(:,1)=exp(x);
    u(1,:)=exp(t);
    u(m+1,:)=exp(1+t);

r = dt /(h^2) ;
row1 = zeros(m-1, 1);
row1(1, 1) = 5/6+r; row1(2, 1) =1/12 -r/2;
A = toeplitz(row1);
row1 = zeros(m-1, 1);
row1(1, 1) = 5/6-r; row1(2, 1) = 1/12+r/2;
B = toeplitz(row1);

for k = 1:n
    H = zeros(m-1, 1);
    H(1, 1) = (1/12+r/2) * u(1, k) -(1/12-r/2)*u(1, k+1);
    H(m-1, 1) =(1/12+r/2) * u(m+1, k) -(1/12-r/2)*u(m+1, k+1);

    u(2:m, k+1) = A\(B*u(2:m, k) + H);
end

% 计算误差
F = zeros(m+1, n+1);
for i = 1:m+1
    for j = 1:n+1
        F(i, j) = exp(x(i)+ t(j));
    end
end
error = abs(u - F);
MaxErr(ii) = max(max(error));
figure(1)
plot(x,u(:,n+1));
figure(2)
plot(x,F(:,n+1));
figure(3)
hold on
plot(x,abs(u(:,n+1)-F(:,n+1)));
end
for l=1:3
     disp(MaxErr(l));
end
for j=1:3 
ord=MaxErr(j)/MaxErr(j+1);
disp(['收敛阶 ',': ', num2str(ord)]);
end