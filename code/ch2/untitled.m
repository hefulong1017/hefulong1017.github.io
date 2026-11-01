for ii=1:4
x1 = 1; x2=2; y1=1;y2=2;t1 = 0; t2 = 1;
s=0.1;
m1=(4*2^ii);
m2=m1;
N=50;
h1 = (x2-x1)/m1; 
h2=h1;
dt = (t2-t1)/N;
x = x1:h1:x2; x = x';
y=y1:h2:y2; y = y';
t = -s:dt:t2; t = t';
n=s/dt;
G=@(x,y,t)5*(t^4)*sin(pi*x)*sin(pi*y)+4*pi^2*(t^5+1)*sin(pi*x)*sin(pi*y)-((t^5+1)*sin(pi*x)*sin(pi*y))^2-(((t-0.1)^5+1)*sin(pi*x)*sin(pi*y))^2;
u = zeros(m1+1,m2+1,N+n+1);
for i = 1:m1+1
    for j = 1:m2+1
        u(i,j,n+1) =sin(pi*x(i))*sin(pi*y(j));
    end
end
for i = 1:m1+1
    for j = 1:m2+1
        u(i,j,n+N+1) =2*sin(pi*x(i))*sin(pi*y(j));
    end
end
for i = 1:m1+1
      for j = 1:m2+1
    for k = 1:n+1
        u(i,j,k) = (t(k)*5+1)*sin(pi*x(i))*sin(pi*y(j));
    end
      end
end
a=2;
r1 = a*dt /(h1^2) ;
r2 = a*dt /(h2^2) ;
I=speye(m1-1,m1-1);
D=-r1*I;
row2 = zeros(m1-1, 1);
row2(1, 1) =-11/6+2*(r1+r2);row2(2, 1) = -r1;
C = toeplitz(row2);
A = kron(diag(ones(1,m2-2),1) + diag(ones(1,m2-2),-1),D)+ kron(diag(ones(1,m2-1)),C);
for k = n+1:N+n+1
    H = zeros(m1-1,1);
for j = 2:m2
    H(1, j-1) = -3*u(2, j, k-1) + 3/2*u(2, j, k-2) - 1/3*u(2, j, k-3) +r1*u(1, j, k)+dt * (G(x(2), y(j), t(k)) + (3*u(2, j, k-1) - 3*u(2, j, k-2) + u(2, j, k-3))^2 + (u(2, j, k-n))^2);
    H(m1-1, j-1) = -3*u(m1, j, k-1) + 3/2*u(m1, j, k-2) - 1/3*u(m1, j, k-3) +r1*u(m1+1, j, k)+dt * (G(x(m1), y(j), t(k)) + (3*u(m1, j, k-1) - 3*u(m1, j, k-2) + u(m1, j, k-3))^2 + (u(m1, j, k-n))^2);
    H(2:m1-2, j-1) = -3*u(3:m1-1, j, k-1) + 3/2*u(3:m1-1, j, k-2) - 1/3*u(3:m1-1, j, k-3)+dt * (G(x(3:m1-1), y(j), t(k)) + (3*u(3:m1-1, j, k-1) - 3*u(3:m1-1, j, k-2) + u(3:m1-1, j, k-3))^2 + (u(3:m1-1, j, k-n))^2); 
   H(:,1) = H(:,1) - D*u(2:m1,1,k);
H(:,m2-1) = H(:,m2-1) - D*u(2:m1,m2+1,k);
end


F = reshape(H + L, (m1-1)*(m2-1), 1);

U1 = A \ F;


u(2:m1, 2:m2, k) = reshape(U1, m1-1,m2-1);
end
F = zeros(m1+1,m2+1, N+n+1);
for i = 1:m1+1
    for j = 1:m2+1
        for l=1:N+n+1
        F(i, j) =(t(l)*5+1)*sin(pi*x(i))*sin(pi*y(j));
        end
    end
end
    MaxErr(ii) = max(max(max(error)));
   
end
disp(MaxErr);
for i=1:3
    ord(i) = MaxErr(i)/MaxErr(i+1);
end
disp(ord);
