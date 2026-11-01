
m=10;
n=100;
x1 = 0; x2 = 1; t1 = 0; t2 = 1;
h = (x2-x1)/m; dt =(t2-t1)/n;
x = x1:h:x2; x = x';
t = t1:dt:t2; t = t';
u = zeros(m+1, n+1);

    u(:,1)=exp(x);
    u(:,2)=exp(x+dt);
    u(1,:)=exp(t);
    u(m+1,:)=exp(1+t);

r = dt /(h^2) ;
row1 = zeros(m-1, 1);
row1(1, 1) = -4*r; row1(2, 1) =2*r;
A = toeplitz(row1);
for k = 2:n
    H = zeros(m-1, 1);
    H(1, 1) = 2*r * u(1, k) +u(1, k-1);
    H(m-1, 1) =2*r * u(m+1, k) +u(m+1, k-1);

    u(2:m, k+1) = A*u(2:m, k)+u(2:m,k-1) + H;
end

% 计算误差
F = zeros(m+1, n+1);
for i = 1:m+1
    for j = 1:n+1
        F(i, j) = exp(x(i)+ t(j));
    end
end
error = abs(u - F);
MaxErr = max(max(error));
     disp(MaxErr);
